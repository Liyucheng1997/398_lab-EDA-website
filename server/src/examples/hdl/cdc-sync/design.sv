`timescale 1ns / 1ps

// 跨时钟域（CDC）基础：
//   sync_2ff   —— 单比特电平信号的两级触发器同步器
//   pulse_sync —— 单拍脉冲跨时钟域：源域翻转一个电平，目的域同步后做边沿检测

// 两级触发器同步器：第一级可能进入亚稳态，第二级给它一个周期的时间恢复
module sync_2ff (
  input  logic clk_dst,
  input  logic rst_dst,
  input  logic d,        // 来自其他时钟域的信号
  output logic q         // 同步到 clk_dst 域
);
  logic meta;

  always_ff @(posedge clk_dst) begin
    if (rst_dst) begin
      meta <= 1'b0;
      q    <= 1'b0;
    end else begin
      meta <= d;
      q    <= meta;
    end
  end
endmodule

// 脉冲同步器：要求源域相邻两个脉冲间隔大于目的域约 3 个周期
module pulse_sync (
  input  logic clk_src,
  input  logic rst_src,
  input  logic pulse_src,  // clk_src 域的单拍脉冲
  input  logic clk_dst,
  input  logic rst_dst,
  output logic pulse_dst   // clk_dst 域的单拍脉冲
);
  logic toggle_src;
  logic toggle_dst;
  logic toggle_dst_d;

  // 源域：每来一个脉冲就翻转一次电平
  always_ff @(posedge clk_src) begin
    if (rst_src)        toggle_src <= 1'b0;
    else if (pulse_src) toggle_src <= ~toggle_src;
  end

  // 电平信号可以安全地用两级同步器跨域
  sync_2ff u_sync (.clk_dst(clk_dst), .rst_dst(rst_dst), .d(toggle_src), .q(toggle_dst));

  // 目的域：检测电平变化，还原成单拍脉冲
  always_ff @(posedge clk_dst) begin
    if (rst_dst) toggle_dst_d <= 1'b0;
    else         toggle_dst_d <= toggle_dst;
  end
  assign pulse_dst = toggle_dst ^ toggle_dst_d;
endmodule
