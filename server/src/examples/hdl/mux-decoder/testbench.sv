`timescale 1ns / 1ps

// 穷举 256 种请求组合 × 4 种选择，与参考模型比对
module tb;
  logic [7:0] req;
  logic [1:0] sel;
  logic [7:0] onehot, y;
  logic       valid;
  integer     errors = 0;

  mux_decoder_top dut (.req(req), .sel(sel), .onehot(onehot), .y(y), .valid(valid));

  // 参考模型：最高位的 1 的位置
  function automatic integer highest(input logic [7:0] r);
    highest = -1;
    for (integer i = 0; i < 8; i = i + 1)
      if (r[i]) highest = i;
  endfunction

  initial begin
    integer     h;
    logic [7:0] exp_onehot, exp_y;
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);

    for (integer r = 0; r < 256; r = r + 1) begin
      for (integer s = 0; s < 4; s = s + 1) begin
        req = r[7:0];
        sel = s[1:0];
        #1;
        h = highest(req);
        exp_onehot = (h < 0) ? 8'd0 : (8'd1 << h);
        case (sel)
          2'd0:    exp_y = req;
          2'd1:    exp_y = exp_onehot;
          2'd2:    exp_y = ~req;
          default: exp_y = (h < 0) ? 8'd0 : h[7:0];
        endcase
        if (valid !== (h >= 0) || onehot !== exp_onehot || y !== exp_y) begin
          if (errors < 10)
            $display("错误：req=%b sel=%0d -> onehot=%b y=%b valid=%b", req, sel, onehot, y, valid);
          errors = errors + 1;
        end
      end
    end

    // 打印几个示例
    show_case(8'b0000_0000);
    show_case(8'b0010_0110);
    show_case(8'b1000_0001);

    if (errors == 0) $display("PASS: 1024 种组合全部正确");
    else             $display("FAIL: %0d 处错误", errors);
    $finish;
  end

  task automatic show_case(input logic [7:0] r);
    req = r;
    sel = 2'd3;
    #1 $display("req = %b -> valid = %b, 编号 = %0d, 独热码 = %b", req, valid, y, onehot);
  endtask
endmodule
