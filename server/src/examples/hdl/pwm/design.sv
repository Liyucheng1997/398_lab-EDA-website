`timescale 1ns / 1ps

// PWM 发生器：W 位自由计数器与占空比比较。
//   周期 = 2^W 个时钟；duty = 0 时恒为 0，duty = 2^W - 1 时有 1 个周期为低。
//   duty 在每个 PWM 周期开始时才更新（影子寄存器），避免周期中途改变产生毛刺。
module pwm #(
  parameter W = 8
) (
  input  logic         clk,
  input  logic         rst,
  input  logic [W-1:0] duty,
  output logic         pwm_out,
  output logic         period_start  // 每个 PWM 周期开始时的单拍脉冲
);
  logic [W-1:0] cnt;
  logic [W-1:0] duty_q;

  always_ff @(posedge clk) begin
    if (rst) begin
      cnt    <= '0;
      duty_q <= '0;
    end else begin
      cnt <= cnt + 1'b1;
      if (cnt == '1) duty_q <= duty;  // 周期末尾锁存新的占空比
    end
  end

  assign pwm_out      = (cnt < duty_q);
  assign period_start = (cnt == '0);
endmodule
