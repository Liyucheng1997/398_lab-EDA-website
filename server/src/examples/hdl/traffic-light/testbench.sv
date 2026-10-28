`timescale 1ns / 1ps

// 检查：1) 任何时刻两个方向不会同时放行；2) 各阶段持续时间正确；
//       3) 行人请求使绿灯提前结束；4) 灯色按 绿→黄→红 顺序变化。
module tb;
  localparam GREEN = 20, MIN_GREEN = 5, YELLOW = 4, ALL_RED = 2;

  logic       clk = 0, rst = 1, ped_req = 0;
  logic [2:0] ns, ew;
  logic       walk;
  integer     errors = 0;

  traffic_light #(.GREEN(GREEN), .MIN_GREEN(MIN_GREEN), .YELLOW(YELLOW), .ALL_RED(ALL_RED)) dut (
    .clk(clk), .rst(rst), .ped_req(ped_req), .ns(ns), .ew(ew), .walk(walk)
  );

  always #5 clk = ~clk;

  function automatic string color(input logic [2:0] l);
    case (l)
      3'b001:  return "GREEN ";
      3'b010:  return "YELLOW";
      3'b100:  return "RED   ";
      default: return "??    ";
    endcase
  endfunction

  // 安全性检查：每个周期都检查
  always @(negedge clk) begin
    if (!rst && ns != 3'b100 && ew != 3'b100) begin
      $display("[%0t] 安全错误：NS=%s EW=%s 同时放行", $time, color(ns), color(ew));
      errors = errors + 1;
    end
    if (!rst && walk && (ns != 3'b100 || ew != 3'b100)) begin
      $display("[%0t] 安全错误：行人通行时机动车未全红", $time);
      errors = errors + 1;
    end
  end

  // 测量当前灯色持续的周期数（在下降沿采样）
  task automatic expect_phase(input logic [2:0] exp_ns, input logic [2:0] exp_ew, input integer cycles);
    integer n;
    n = 0;
    while (ns == exp_ns && ew == exp_ew) begin
      n = n + 1;
      @(negedge clk);
    end
    $display("NS %s / EW %s 持续 %0d 拍", color(exp_ns), color(exp_ew), n);
    if (n != cycles) begin
      $display("  错误：期望 %0d 拍", cycles);
      errors = errors + 1;
    end
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (2) @(negedge clk);
    rst = 0;

    $display("—— 无行人请求的完整周期 ——");
    expect_phase(3'b001, 3'b100, GREEN);
    expect_phase(3'b010, 3'b100, YELLOW);
    expect_phase(3'b100, 3'b100, ALL_RED);
    expect_phase(3'b100, 3'b001, GREEN);
    expect_phase(3'b100, 3'b010, YELLOW);
    expect_phase(3'b100, 3'b100, ALL_RED);

    $display("—— NS 绿灯第 2 拍按下行人按钮 ——");
    @(negedge clk);                 // NS 绿灯第 2 拍
    ped_req = 1;
    @(negedge clk) ped_req = 0;     // 此时绿灯已亮 2 拍
    expect_phase(3'b001, 3'b100, MIN_GREEN - 2);
    expect_phase(3'b010, 3'b100, YELLOW);
    expect_phase(3'b100, 3'b100, ALL_RED);
    expect_phase(3'b100, 3'b001, GREEN);  // 请求已被服务，EW 绿灯不受影响

    if (errors == 0) $display("PASS: 交通灯时序与安全性检查全部通过");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
